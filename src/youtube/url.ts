export function isYouTubeWatch(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === 'https://www.youtube.com' &&
      parsed.pathname === '/watch' &&
      /^[\w-]{1,64}$/.test(parsed.searchParams.get('v') ?? '')
    );
  } catch {
    return false;
  }
}
