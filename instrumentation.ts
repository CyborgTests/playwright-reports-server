export async function register() {
  console.log('[instrumentation] Server initializing...');

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { lifecycle } = await import('@/app/lib/service/lifecycle');

    await lifecycle.initialize();

    console.log('[instrumentation] Server initialization complete');
  }
}
