import { NextResponse } from 'next/server';
import { validateAdminPassword } from '@/lib/adminAuth';

export async function POST(request: Request) {
  try {
    const { password } = await request.json();
    const auth = validateAdminPassword(password);

    if (auth.ok) {
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: auth.error },
      { status: auth.status }
    );
  } catch (error) {
    return NextResponse.json(
      { error: '验证过程出错' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
