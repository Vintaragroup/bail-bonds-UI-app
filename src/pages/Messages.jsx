export default function Messages() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Messages</h1>
      <p className="text-sm text-gray-600">TODO: Outbox/Inbox with filters & templates.</p>
      <ul className="list-disc pl-6 text-sm text-gray-700">
        <li>API: GET /api/messages?direction=&channel=&status=&from=&to=&limit=&cursor=</li>
        <li>API: GET /api/templates</li>
        <li>API: POST /api/messages (Telnyx proxy)</li>
      </ul>
    </section>
  );
}