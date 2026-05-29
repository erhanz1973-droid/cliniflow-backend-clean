/**
 * Operational build metadata for /api/health and admin debug strip.
 * Bump apiBuild + schemaMigrationsHead when shipping migrations or admin static.
 */

module.exports = {
  service: "cliniflow-backend-clean",
  apiBuild: "2026.05.18",
  schemaMigrationsHead: "20260531120000",
};
