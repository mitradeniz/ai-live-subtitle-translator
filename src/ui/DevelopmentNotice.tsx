export function DevelopmentNotice() {
  return (
    <section className="notice" aria-label="Development status">
      <p className="status">
        {import.meta.env.MODE === 'mock'
          ? 'MOCK · Test build'
          : 'Early development'}
      </p>
      <p>
        {import.meta.env.MODE === 'mock'
          ? 'This test build repeats available captions with a [MOCK] prefix. It does not translate.'
          : 'Native tracks and YouTube captions are experimental. Choose experimental Google, Google Cloud or AI in settings. Paid engines require your own key and explicit selection.'}
      </p>
    </section>
  );
}
