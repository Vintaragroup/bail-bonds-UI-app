export default function Cases() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Cases</h1>
      <p className="text-sm text-gray-600">
        TODO: server-side table with search, filters, pagination.
      </p>
      <ul className="list-disc pl-6 text-sm text-gray-700">
        <li>API: GET /api/cases?query=&county=&status=&limit=&cursor=</li>
        <li>API: GET /api/cases/:id (drawer or page)</li>
        <li>Actions: send reminder (POST /api/messages)</li>
      </ul>
    </section>
  );
}