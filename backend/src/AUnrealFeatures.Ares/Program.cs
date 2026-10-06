using AUnrealFeatures.Hosting;
using AUnrealFeatures.Hosting.Application;
using AUnrealFeatures.Hosting.Database;
using AUnrealFeatures.Hosting.Database.Interfaces;
using AUnrealFeatures.Ares.Models;
using AUnrealFeatures.Ares.Servers;
using AUnrealFeatures.AAMothership;
using AUnrealFeatures.AAMothership.Models;
using AUnrealFeatures.EOSSDK;
using AUnrealFeatures.HalcyonSocket;

namespace AUnrealFeatures.Ares
{
    /// <summary>
    /// Backend host: Mothership + station/dashboard servers, plus the EOS gateway and the
    /// HalcyonSocket orchestrator.
    ///
    ///   :90    MothershipServer     player auth and player data (the client's BaseUrl)
    ///   :78    A2StationDbServer    station / deployment API - what the game server payload
    ///                               registers against (register_server, update_player_count)
    ///   :8080  AresDashboardServer  read API + the dashboard's backend
    ///   :50    EosGatewayServer     EOS-compatible gateway (server list / matchmaking)
    ///   :80    EosWsServer          EOS websocket (lobby / RTC)
    ///   :9095  HalcyonSocketServer  orchestrator control (localhost) + :9100 agent TCP
    ///
    /// EOSSDK and HalcyonSocket are referenced because the servers above share their static
    /// stores (the in-memory EOS session list, the pending-name table).
    /// </summary>
    public static class Program
    {
        private static IDatabase _database;
        private static IHostApplication _hostApplication;

        public static IDatabase Database => _database;

        // Local LiteDB file password for the production database. There is NO fixed
        // fallback password: without ORION_DB_PASSWORD the backend either refuses to
        // start (Production) or generates an ephemeral per-run password (development),
        // which is clearly logged. Installers generate and persist a strong value.
        private static string DatabasePassword()
        {
            var v = Environment.GetEnvironmentVariable("ORION_DB_PASSWORD");
            if (!string.IsNullOrWhiteSpace(v)
                && !v.StartsWith("CHANGE_ME", StringComparison.OrdinalIgnoreCase)
                && !v.StartsWith("YOUR_", StringComparison.OrdinalIgnoreCase))
                return v;
            if (IsProduction())
                throw new InvalidOperationException(
                    "ORION_DB_PASSWORD is not set. Production refuses to start without a database " +
                    "password. Set it in .env (installers generate one automatically).");
            Console.WriteLine("[DB] ORION_DB_PASSWORD is not set -- generated an EPHEMERAL database " +
                              "password for this development run. The data file will be unreadable " +
                              "after restart. Set ORION_DB_PASSWORD for anything persistent.");
            return "ephemeral-dev-only-" + Convert.ToHexString(
                System.Security.Cryptography.RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        }

        // ORION_ENVIRONMENT=Production enables strict startup validation (see
        // ValidateProductionConfig). Anything else is development mode.
        internal static bool IsProduction()
            => string.Equals(Environment.GetEnvironmentVariable("ORION_ENVIRONMENT") ?? "",
                "Production", StringComparison.OrdinalIgnoreCase);

        static bool IsSecretPlaceholder(string? v)
            => string.IsNullOrWhiteSpace(v)
            || v.StartsWith("CHANGE_ME", StringComparison.OrdinalIgnoreCase)
            || v.StartsWith("YOUR_", StringComparison.OrdinalIgnoreCase)
            || v.StartsWith("<FILL_ME", StringComparison.OrdinalIgnoreCase);

        static bool IsTruthy(string? v)
            => (v ?? "") is "1" or "true" or "TRUE" or "yes";

        // Production gate: refuse to start a public-mode backend on insecure
        // configuration, with one aggregated, actionable error. Development mode
        // stays frictionless (individual warnings only).
        static void ValidateProductionConfig()
        {
            if (!IsProduction())
            {
                Console.WriteLine("[ENV] ORION_ENVIRONMENT is not Production -- running in development mode.");
                return;
            }
            var bad = new System.Collections.Generic.List<string>();
            foreach (var name in new[]
            {
                "ORION_SERVER_API_KEY", "ORION_DASHBOARD_API_KEY",
                "ORION_DASHBOARD_ADMIN_KEY", "ORION_DASHBOARD_SESSION_SECRET",
                "ORION_AUTOMATION_KEY", "ORION_DB_PASSWORD", "ORION_AGENT_KEY",
            })
            {
                var v = Environment.GetEnvironmentVariable(name);
                if (IsSecretPlaceholder(v)) bad.Add($"{name} is missing or a placeholder");
                else if (v!.Trim().Length < 16) bad.Add($"{name} is too short (min 16 chars)");
            }
            if (IsTruthy(Environment.GetEnvironmentVariable("ORION_ENABLE_DEBUG_ENDPOINTS")))
                bad.Add("ORION_ENABLE_DEBUG_ENDPOINTS must be false in Production");
            if (IsTruthy(Environment.GetEnvironmentVariable("ORION_ALLOW_ATTESTATION_FAIL_OPEN")))
                bad.Add("ORION_ALLOW_ATTESTATION_FAIL_OPEN must be false in Production");
            if (IsTruthy(Environment.GetEnvironmentVariable("ORION_INSECURE"))
                || IsTruthy(Environment.GetEnvironmentVariable("MOTHERSHIP_INSECURE")))
                bad.Add("ORION_INSECURE/MOTHERSHIP_INSECURE must be off in Production");
            // Server-control reachability: :78 self-registration is open by design, so a
            // remotely reachable :78 without the key gate is an open control plane.
            var exposeStationDb = IsTruthy(Environment.GetEnvironmentVariable("ORION_EXPOSE_STATIONDB"));
            var requireRegKey = IsTruthy(Environment.GetEnvironmentVariable("ORION_REQUIRE_REGISTRATION_KEY"));
            if (exposeStationDb && !requireRegKey)
                bad.Add("ORION_EXPOSE_STATIONDB=1 exposes open self-registration directly; " +
                        "set ORION_REQUIRE_REGISTRATION_KEY=1 (after confirming payloads send the key) " +
                        "or keep :78 private/firewall-scoped");
            var domain = (Environment.GetEnvironmentVariable("ORION_DOMAIN") ?? "").Trim();
            if (!string.IsNullOrEmpty(domain) && !requireRegKey)
                Console.WriteLine("[ENV] WARNING: ORION_DOMAIN serves StationDb publicly; keep the " +
                                  "Caddy control-path blocks from deploy/Caddyfile.example in place, or set " +
                                  "ORION_REQUIRE_REGISTRATION_KEY=1. Removing those blocks without the key " +
                                  "gate re-opens unauthenticated registration to the Internet.");
            // Management listeners must never be wildcard-bound in Production: use an
            // explicit LAN IP when remote access is genuinely needed.
            foreach (var name in new[] { "ORION_INTERNAL_BIND", "ORION_AGENT_BIND" })
            {
                var b = (Environment.GetEnvironmentVariable(name) ?? "").Trim();
                if (b == "0.0.0.0" || b == "*")
                    bad.Add($"{name} must not be 0.0.0.0 in Production (use 127.0.0.1 or an explicit LAN IP)");
            }
            if (bad.Count > 0)
                throw new InvalidOperationException(
                    "Production startup refused:\n  - " + string.Join("\n  - ", bad) +
                    "\nSet the values in .env (installers generate secrets automatically) and restart.");
            if (MothershipServer.AllowSharedPcIdentity())
                Console.WriteLine("[ENV] WARNING: ORION_ALLOW_SHARED_PC_IDENTITY=true in Production -- " +
                                  "every PC player shares one identity. This is an explicit operator choice.");
            Console.WriteLine("[ENV] Production configuration validated.");
        }

        public static async Task Main(string[] args)
        {
            ModuleInitialization.Initialize();
            ValidateProductionConfig();
            _hostApplication = HostApplication.New("Astra")
                .ConfigureServices(services =>
                {
                    var databaseManager = AstraDatabaseBuilder.Shared
                        .WithDatabase("production", new DatabaseOptions
                        {
                            databaseId = 1,
                            friendlyName = "Production Database",
                            usePassword = true,
                            // Local LiteDB file password. Read from ORION_DB_PASSWORD so no
                            // secret is baked into the source; the installer generates one and
                            // stores it in .env. A placeholder here only logs a warning because
                            // the database file itself never leaves this host.
                            password = DatabasePassword()
                        })
                        .WithDatabase("development", new DatabaseOptions
                        {
                            databaseId = 2,
                            friendlyName = "Development Database",
                            usePassword = false,
                            password = string.Empty
                        })
                        .Build();

                    if (databaseManager != null)
                    {
                        services.AddSingleton<AstraDatabaseManager, IDatabaseManager>(
                            (AstraDatabaseManager?)databaseManager
                        );

#if DEBUG
                        var database = (AstraDatabase?)databaseManager.GetDatabase(name: "development", id: 2);
#elif !DEBUG
                        var database = (AstraDatabase?)databaseManager.GetDatabase(name: "production", id: 1);
#endif

                        _database = database;
                        services.AddSingleton<AstraDatabase, IDatabase>(database);

                        // ── stations, deployments, events, dashboard accounts ──
                        database?.GetCollection<UserDataResponse>(true);
                        database?.GetCollection<RoleResponse>(true);
                        database?.GetCollection<StationDbObject>(true);
                        database?.GetCollection<DeploymentDbObject>(true);
                        database?.GetCollection<ServerEventDbObject>(true);
                        database?.GetCollection<StationEventDbObject>(true);
                        database?.GetCollection<EventSignupDbObject>(true);
                        database?.GetCollection<UserApiKeyDbObject>(true);

                        // ── Mothership ─────────────────────────────────────────
                        MothershipServer.Database = database!;
                        database?.GetCollection<MothershipPlayerDbObject>(true);
                        database?.GetCollection<MothershipSessionDbObject>(true);
                        database?.GetCollection<MothershipV2PlayerDbObject>(true);
                        database?.GetCollection<MothershipAssociationDbObject>(true);
                        database?.GetCollection<MothershipLinkDbObject>(true);
                        database?.GetCollection<MothershipSharedGroupDbObject>(true);
                        database?.GetCollection<MothershipReportDbObject>(true);
                        database?.GetCollection<MothershipBanDbObject>(true);
                        database?.GetCollection<MothershipMuteDbObject>(true);
                    }
                })
                .AddServer<IA2StationDbServer, A2StationDbServer>()      // :78
                .AddServer<IAresDashboardServer, AresDashboardServer>()  // :8080
                .AddServer<IMothershipServer, MothershipServer>()        // :90

                //   EOS gateway :50 + websocket :80 - our stand-in for the Epic Online Services
                //   API. The in-game station/server list is served by
                //   /matchmaking/v1/{deployment_id}/filter on this gateway, so it has to be
                //   running for players to see any servers at all.
                .AddServer<IEosGatewayServer, EosGatewayServer>()
                .AddServer<IEosWsServer, EosWsServer>()

                //   Halcyon socket - :9095 HTTP control (loopback) + :9100 agent TCP. The dashboard's
                //   "Spin Up" relays through it to a connected allocator agent, which launches and
                //   injects a game server that then self-registers. :9095 mutations need loopback
                //   or ORION_SERVER_API_KEY; :9100 agents authenticate with ORION_AGENT_KEY
                //   (loopback skips it). Keep both off the public internet regardless.
                .AddServer<IHalcyonSocketServer, HalcyonSocketServer>();

            // The watchdog decides a server is down; taking it OUT of the station browser needs the EOS
            // session store and the deployment table, which live over here. Wiring it as a hook keeps
            // HalcyonSocket's single project reference intact (Ares -> HalcyonSocket, never back).
            // A crashed or frozen server never deletes its own session, so without this the station
            // stays listed and players keep joining a corpse for the whole restart.
            ServerWatchdog.TakeDeploymentOffline = (deploymentId, reason) =>
            {
                var dropped = EosGatewayServer.RemoveSessionsByDeployment(deploymentId);

                var depCol = Database.GetCollection<DeploymentDbObject>(true);
                var dep    = depCol?.FindAll().FirstOrDefault(d => d.DeploymentId == deploymentId);
                if (dep != null)
                {
                    dep.Online      = false;
                    dep.PlayerCount = 0;
                    depCol!.Update(dep);
                }
                Console.WriteLine($"[Watchdog] took deployment {deploymentId} out of the browser ({reason}): " +
                                  $"{dropped} session(s) dropped, db row {(dep != null ? "marked offline" : "not found")}");
            };

            // Hand the EOS gateway every station's browser whitelist before serving. It cannot read them
            // itself (Ares -> EOSSDK, never back), and an allowlist with no data fails OPEN -- so without
            // this a backend restart would silently unhide every private station until the next config edit.
            StationAcl.PushAll();
            StationBans.Start();   // and the ban lists (banned accounts never get the banned station's servers)

            await _hostApplication.RunAsync();
        }
    }
}
