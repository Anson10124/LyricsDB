// @ts-nocheck
import * as __fd_glob_15 from "../content/docs/lyrics/streamLyrics.mdx?collection=docs"
import * as __fd_glob_14 from "../content/docs/lyrics/getLyricsById.mdx?collection=docs"
import * as __fd_glob_13 from "../content/docs/lyrics/getLyrics.mdx?collection=docs"
import * as __fd_glob_12 from "../content/docs/tracks/searchTracks.mdx?collection=docs"
import * as __fd_glob_11 from "../content/docs/tracks/postTrack.mdx?collection=docs"
import * as __fd_glob_10 from "../content/docs/tracks/getTrackById.mdx?collection=docs"
import * as __fd_glob_9 from "../content/docs/tracks/getTrack.mdx?collection=docs"
import * as __fd_glob_8 from "../content/docs/supported-platforms.mdx?collection=docs"
import * as __fd_glob_7 from "../content/docs/streaming.mdx?collection=docs"
import * as __fd_glob_6 from "../content/docs/quickstart.mdx?collection=docs"
import * as __fd_glob_5 from "../content/docs/index.mdx?collection=docs"
import * as __fd_glob_4 from "../content/docs/formats.mdx?collection=docs"
import * as __fd_glob_3 from "../content/docs/api-overview.mdx?collection=docs"
import { default as __fd_glob_2 } from "../content/docs/tracks/meta.json?collection=docs"
import { default as __fd_glob_1 } from "../content/docs/lyrics/meta.json?collection=docs"
import { default as __fd_glob_0 } from "../content/docs/meta.json?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();

export const docs = await create.docs("docs", "content/docs", {"meta.json": __fd_glob_0, "lyrics/meta.json": __fd_glob_1, "tracks/meta.json": __fd_glob_2, }, {"api-overview.mdx": __fd_glob_3, "formats.mdx": __fd_glob_4, "index.mdx": __fd_glob_5, "quickstart.mdx": __fd_glob_6, "streaming.mdx": __fd_glob_7, "supported-platforms.mdx": __fd_glob_8, "tracks/getTrack.mdx": __fd_glob_9, "tracks/getTrackById.mdx": __fd_glob_10, "tracks/postTrack.mdx": __fd_glob_11, "tracks/searchTracks.mdx": __fd_glob_12, "lyrics/getLyrics.mdx": __fd_glob_13, "lyrics/getLyricsById.mdx": __fd_glob_14, "lyrics/streamLyrics.mdx": __fd_glob_15, });