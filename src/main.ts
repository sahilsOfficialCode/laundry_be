import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
