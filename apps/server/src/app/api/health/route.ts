import { NextResponse } from 'next/server';
import { gpuHealth } from '@/lib/encoder-policy';

export async function GET() {
  // GPU state without reasons: this endpoint is public. Reasons are in the server log.
  const gpu = gpuHealth();
  return NextResponse.json({
    status: 'ok',
    service: 'twentyfourseven',
    gpu: { state: gpu.state, cpuFallbacks: gpu.cpuFallbacks },
  });
}
