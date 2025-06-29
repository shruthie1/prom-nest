import { NestFactory } from '@nestjs/core';
import mongoose from 'mongoose'
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import * as fs from 'fs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = new DocumentBuilder()
    .setTitle('NestJS and Express API')
    .setDescription('API documentation')
    .setVersion('1.0')
    .build();

  app.enableCors({
    allowedHeaders: "*",
    origin: "*"
  });
  const document = SwaggerModule.createDocument(app, config);
  fs.writeFileSync('./swagger-spec.json', JSON.stringify(document, null, 2));
  SwaggerModule.setup('api', app, document);
  mongoose.set('debug', true)
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    // whitelist: true,
    // forbidNonWhitelisted: true,
    transformOptions: {
      enableImplicitConversion: true
    },
    // validationError: {
    //   target: false,
    //   value: undefined
    // }
  }));
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (reason, promise) => {
    console.error(promise, reason);
  });

  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`${signal} received`);
    await app.close();
    process.exit(0);
  };

  process.on('exit', async () => {
    console.log('Application closed');
  });

  process.on('SIGINT', async () => {
    await shutdown('SIGINT');
  });

  process.on('SIGTERM', async () => {
    await shutdown('SIGTERM');
  });

  process.on('SIGQUIT', async () => {
    await shutdown('SIGQUIT');
  });

  await app.init();
  await app.listen(process.env.PORT || 9000);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
