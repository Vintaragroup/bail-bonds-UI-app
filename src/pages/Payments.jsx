export default function Payments() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Payments</h1>
      <p className="text-sm text-gray-600">TODO: Due (7d/30d), Late, Paid views.</p>
      <ul className="list-disc pl-6 text-sm text-gray-700">
        <li>API: GET /api/payments?status=due|late|paid&range=7d|30d&limit=&cursor=</li>
        <li>API: POST /api/payments/:id/note</li>
      </ul>
    </section>
  );
}