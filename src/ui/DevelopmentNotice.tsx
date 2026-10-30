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
          ? 'The local timing lab repeats captions with a [MOCK] prefix. It does not translate.'
          : 'Native HTML5 captions are available on demand. Translation and API-key setup are not available yet.'}
      </p>
    </section>
  );
}
