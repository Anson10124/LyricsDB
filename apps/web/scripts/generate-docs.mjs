import { generateFiles } from 'fumadocs-openapi';
import { createOpenAPI } from 'fumadocs-openapi/server';

const openapi = createOpenAPI({
  input: ['./openapi.json'],
});

async function main() {
  await generateFiles({
    input: openapi,
    output: './content/docs/api',
  });
  console.log('[OpenAPI] Successfully generated API documentation MDX files.');
}

main().catch((err) => {
  console.error('[OpenAPI] Failed to generate files:', err);
  process.exit(1);
});
