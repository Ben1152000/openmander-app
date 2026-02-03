/**
 * Utility functions for managing the PMTiles cache
 */

import { getCacheStats, clearPMTilesCache } from "./pmtilesCache";

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

/**
 * Get cache status for display
 */
export async function getCacheStatus(): Promise<string> {
  try {
    const stats = await getCacheStats();
    if (stats.fileCount === 0) {
      return "Cache: Empty";
    }
    return `Cache: ${formatBytes(stats.totalSize)} (${stats.fileCount} file${stats.fileCount !== 1 ? "s" : ""})`;
  } catch (err) {
    console.warn("Failed to get cache status:", err);
    return "Cache: Unknown";
  }
}

/**
 * Clear cache and show confirmation
 */
export async function clearCache(): Promise<boolean> {
  try {
    if (confirm("Clear all cached geometry tiles? You'll need to download them again.")) {
      await clearPMTilesCache();
      return true;
    }
    return false;
  } catch (err) {
    console.error("Failed to clear cache:", err);
    alert("Failed to clear cache");
    return false;
  }
}
