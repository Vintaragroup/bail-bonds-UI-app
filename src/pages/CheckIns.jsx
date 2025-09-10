export default function CheckIns() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Check-ins</h1>
      <p className="text-sm text-gray-600">
        TODO: Tabs for Today / Overdue / All with quick actions.
      </p>
      <ul className="list-disc pl-6 text-sm text-gray-700">
        <li>API: GET /api/checkins?scope=today|overdue|all&limit=&cursor=</li>
        <li>API: POST /api/checkins/:id/complete</li>
        <li>API: POST /api/messages/batch (batch reminders)</li>
      </ul>
    </section>
  );
}