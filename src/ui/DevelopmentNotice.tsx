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
          : 'Native tracks and visible YouTube captions are supported experimentally. Real translation is not available yet.'}
      </p>
    </section>
  );
}
