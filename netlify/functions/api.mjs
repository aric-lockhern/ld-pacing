// Netlify Function: the dashboard's fast read API at /api (and /api/ingest for the
// Apps Script publisher). The logic lives in ../lib/fastapi.mjs so the tests can
// run it against an in-memory store without Netlify.
import { getStore } from '@netlify/blobs';
import { handle } from '../lib/fastapi.mjs';

export default async (req) => handle(req, getStore({ name: 'ldpacing', consistency: 'strong' }), { INGEST_SECRET: process.env.INGEST_SECRET });

export const config = { path: ['/api', '/api/ingest'] };
