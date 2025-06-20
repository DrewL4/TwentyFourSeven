import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const baseUrl = process.env.BASE_URL || `${request.nextUrl.protocol}//${request.nextUrl.host}`;
    
    const discovery = {
      FriendlyName: "TwentyFourSeven",
      Manufacturer: "Silicondust",
      ModelNumber: "HDTC-2US",
      FirmwareName: "hdhomerun3_atsc",
      TunerCount: 6,
      FirmwareVersion: "20150826",
      DeviceID: "12345678",
      DeviceAuth: "test1234",
      BaseURL: baseUrl,
      LineupURL: `${baseUrl}/api/lineup.json`
    };

    return NextResponse.json(discovery, {
      headers: {
        'Content-Type': 'application/json',
      }
    });

  } catch (error) {
    console.error('Error generating discovery:', error);
    return NextResponse.json({ error: 'Failed to generate discovery' }, { status: 500 });
  }
} 