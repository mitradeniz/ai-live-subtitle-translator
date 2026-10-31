import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

// These npm distributions omit their license files. Exact reviewed versions only;
// source commits and original notices are kept in third-party/README.md.
const supplemental: Record<string, string> = {
  'wxt@0.21.5': 'wxt-LICENSE',
  '@wxt-dev/storage@1.3.0': 'storage-LICENSE',
  '@wxt-dev/browser@0.3.7': 'browser-LICENSE',
};

// WXT builds several entrypoints separately. Collect their actual bundled modules
// before writing one distribution notice; never publish machine-local paths.
export function buildNotices() {
  const modules = new Set<string>();
  const plugin: Plugin = {
    name: 'packaged-dependency-notices',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const [id, details] of Object.entries(output.modules))
          if (id.includes('/node_modules/') && details.renderedLength > 0)
            modules.add(id.split('?')[0]!);
      }
    },
  };
  async function write(outputDirectory: string) {
    await writeFile(
      join(outputDirectory, 'LICENSE.txt'),
      await readFile('LICENSE', 'utf8'),
    );
    const packages = new Map<
      string,
      { name: string; version: string; license: string; text: string }
    >();
    for (const id of modules) {
      let folder = dirname(id);
      while (folder !== parse(folder).root) {
        let raw: string;
        try {
          raw = await readFile(join(folder, 'package.json'), 'utf8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          folder = dirname(folder);
          continue;
        }
        const pkg = JSON.parse(raw) as {
          name?: string;
          version?: string;
          license?: string;
        };
        if (!pkg.name || !pkg.version) {
          folder = dirname(folder);
          continue;
        }
        const key = `${pkg.name}@${pkg.version}`;
        if (packages.has(key)) break;
        const names = (await readdir(folder))
          .filter((name) => /^(licen[cs]e|notice)(?:[.-].*)?$/i.test(name))
          .sort();
        const fallback = supplemental[key];
        if (
          !pkg.license ||
          (!names.some((name) => /^licen[cs]e/i.test(name)) && !fallback)
        )
          throw new Error(`Missing distribution license for ${key}`);
        const texts = await Promise.all(
          names.map((name) => readFile(join(folder, name), 'utf8')),
        );
        if (!names.some((name) => /^licen[cs]e/i.test(name)) && fallback)
          texts.push(await readFile(join('third-party', fallback), 'utf8'));
        packages.set(key, {
          name: pkg.name,
          version: pkg.version,
          license: pkg.license,
          text: texts.join('\n\n'),
        });
        break;
      }
    }
    // WXT storage ships dequal/lite prebundled; Vite cannot expose it as a
    // separate module. Keep this reviewed nested attribution version-specific.
    if (packages.has('@wxt-dev/storage@1.3.0'))
      packages.set('dequal@2.0.3', {
        name: 'dequal',
        version: '2.0.3',
        license: 'MIT',
        text: await readFile(join('third-party', 'dequal-LICENSE'), 'utf8'),
      });
    if (!packages.size)
      throw new Error('No bundled dependency provenance collected');
    const sorted = [...packages.entries()].sort(([a], [b]) =>
      a.localeCompare(b, 'en'),
    );
    await writeFile(
      join(outputDirectory, 'THIRD_PARTY_NOTICES.txt'),
      (await readFile('assets/provider-artwork.md', 'utf8')) +
        '\n\nThird-party software included in this extension\n\n' +
        sorted
          .map(
            ([key, pkg]) =>
              `${key} (${pkg.license})\n${'='.repeat(72)}\n${pkg.text}`,
          )
          .join('\n\n'),
    );
    await writeFile(
      join(outputDirectory, 'dependency-provenance.json'),
      JSON.stringify(
        sorted.map(([, pkg]) => ({
          name: pkg.name,
          version: pkg.version,
          license: pkg.license,
          licenseSha256: createHash('sha256').update(pkg.text).digest('hex'),
        })),
        null,
        2,
      ) + '\n',
    );
  }
  return { plugin, write };
}
