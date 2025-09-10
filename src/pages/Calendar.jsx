export default function Calendar() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Court Calendar</h1>
      <p className="text-sm text-gray-600">TODO: 7/30 day list & calendar view.</p>
      <ul className="list-disc pl-6 text-sm text-gray-700">
        <li>API: GET /api/court-events?from=&to=&county=</li>
        <li>API: POST /api/messages (court reminder)</li>
      </ul>
    </section>
  );
}