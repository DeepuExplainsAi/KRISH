export function Security() {
  return (
    <section>
      <h2>Security</h2>
      <ul className="list plain">
        <li>Your API keys are stored in secure device storage and sent only to the provider you set them for, in request headers.</li>
        <li>Passwords, one-time codes and card numbers are typed into this app's own card. The app fills the page. They never reach an AI, the history or any log.</li>
        <li>Text from login, banking and payment pages is not sent to a provider unless you allow it for that provider.</li>
        <li>Page and email content is treated as data, never as instructions.</li>
        <li>Sending, uploading, deleting and changing settings always show you the exact content first.</li>
        <li>No analytics, ads, crash reporting or remote code. Nothing leaves the device except requests to the AI providers you add and the sites you open.</li>
        <li>STOP is always visible. Take over pauses the agent so you can act yourself.</li>
      </ul>
    </section>
  );
}
