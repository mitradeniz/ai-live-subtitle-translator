import { z } from 'zod';

// Extension CSP forbids dynamic code generation, including Zod's eval probe.
z.config({ jitless: true });

export { z };
