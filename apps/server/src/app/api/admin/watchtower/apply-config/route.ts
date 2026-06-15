import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/context';

function extractToken(request: NextRequest): string | null {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Token ')) return auth.slice(6).trim();
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

// POST /api/admin/watchtower/apply-config — hub-pushed config from WatchTower
export async function POST(request: NextRequest) {
  const token = extractToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Token authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const watchtowerBaseUrl = (body.watchtower_base_url || '').replace(/\/$/, '');
    const apiToken = body.api_token || '';
    const webhookSecret = body.webhook_secret || '';

    if (!watchtowerBaseUrl || !apiToken) {
      return NextResponse.json(
        { error: 'watchtower_base_url and api_token required' },
        { status: 400 },
      );
    }

    if (token !== apiToken) {
      const validateResponse = await fetch(
        `${watchtowerBaseUrl}/api/api/v1/auth/validate-api-token/`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        },
      );
      if (!validateResponse.ok) {
        return NextResponse.json({ error: 'Invalid hub token' }, { status: 401 });
      }
      const validateBody = await validateResponse.json();
      if (!validateBody.valid) {
        return NextResponse.json({ error: 'Invalid hub token' }, { status: 401 });
      }
    }

    const upserts = [
      { key: 'watchtower_url', value: watchtowerBaseUrl },
      { key: 'watchtower_api_token', value: apiToken },
      { key: 'watchtower_hub_managed', value: body.hub_managed ? 'true' : 'false' },
      {
        key: 'watchtower_redis_stream_enabled',
        value: body.redis_stream_enabled ? 'true' : 'false',
      },
    ];

    if (webhookSecret) {
      upserts.push({ key: 'watchtower_webhook_secret', value: webhookSecret });
    }

    for (const row of upserts) {
      await db.setting.upsert({
        where: { key: row.key },
        update: { value: row.value },
        create: row,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'WatchTower hub configuration applied',
      hub_managed: !!body.hub_managed,
    });
  } catch (error) {
    console.error('apply-config error:', error);
    return NextResponse.json(
      { error: 'Failed to apply configuration' },
      { status: 500 },
    );
  }
}
