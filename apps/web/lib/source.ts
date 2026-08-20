import { docs } from '.source/server';
import { loader } from 'fumadocs-core/source';
import { openapi } from './openapi';

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
  plugins: [openapi.loaderPlugin()],
});
