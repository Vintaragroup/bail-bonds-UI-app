export default function Admin() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Admin</h1>
      <p className="text-sm text-gray-600">TODO: Scraper health, jobs, integrations, users/roles.</p>
      <ul className="list-disc pl-6 text-sm text-gray-700">
        <li>API: GET /api/system/jobs</li>
        <li>API: POST /api/system/jobs/:name/run</li>
        <li>API: GET /api/system/integrations</li>
        <li>API: Users CRUD (RBAC)</li>
      </ul>
    </section>
  );
}