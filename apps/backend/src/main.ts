import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 8090;
  await app.listen(port);
  console.log(`Pi-Hive backend running on port ${port}`);
}
bootstrap();