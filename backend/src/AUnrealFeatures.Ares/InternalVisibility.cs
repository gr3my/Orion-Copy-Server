using System.Runtime.CompilerServices;

// Test seam only: lets the OrionCopyServer.Tests project exercise internal guard
// logic (StationApiGuard.IsExternal). No runtime effect on the backend itself.
[assembly: InternalsVisibleTo("OrionCopyServer.Tests")]
