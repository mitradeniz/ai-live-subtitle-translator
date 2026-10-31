// Only use for reads: timing out does not cancel a browser API operation.
export class ReadTimeout extends Error {}
export async function readWithDeadline<T>(
  read: Promise<T>,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ReadTimeout('Status unavailable')),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
