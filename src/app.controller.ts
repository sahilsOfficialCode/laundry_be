import { Controller, Get, Header } from '@nestjs/common';
import { Public } from './auth/decorators/public.decorator';

@Controller()
export class AppController {
  @Public()
  @Get()
  @Header('Content-Type', 'text/html')
  getWelcome(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LaundryBrew API</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #2453FF 0%, #0A1645 100%);
      color: #fff;
    }
    .card {
      text-align: center;
      padding: 48px 56px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 24px;
      backdrop-filter: blur(10px);
    }
    .logo { font-size: 56px; margin-bottom: 16px; }
    h1 { font-size: 28px; font-weight: 800; margin-bottom: 8px; }
    p { font-size: 15px; opacity: 0.85; }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 20px;
      padding: 8px 18px;
      background: rgba(34, 197, 94, 0.18);
      border: 1px solid rgba(34, 197, 94, 0.4);
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      color: #86EFAC;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22C55E;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🧺</div>
    <h1>Welcome to LaundryBrew</h1>
    <p>Fresh clothes, brewed to perfection.</p>
    <div class="status"><span class="dot"></span> API is up and running</div>
  </div>
</body>
</html>`;
  }

  @Public()
  @Get('health')
  getHealth() {
    return { status: 'ok', service: 'laundrybrew-api', timestamp: new Date().toISOString() };
  }
}
