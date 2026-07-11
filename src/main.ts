import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody:true makes Nest additionally stash the raw request bytes on
  // req.rawBody for every route, without changing how req.body is parsed
  // anywhere else — needed so the Razorpay webhook can verify its HMAC
  // signature against the exact bytes Razorpay signed, not a re-serialized copy.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.use(morgan('combined'));
  
  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.use(cookieParser());
  // transform + implicit conversion lets DTOs coerce query/param strings to
  // their declared types (e.g. numeric pagination) and apply default values.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
