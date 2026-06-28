import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ServiceAccount,
  ServiceAccountSchema,
} from './schemas/service-account.schema';
import { ServiceAccountService } from './service-account.service';
import { ServiceAccountController } from './service-account.controller';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ServiceAccount.name, schema: ServiceAccountSchema },
    ]),
  ],
  controllers: [ServiceAccountController],
  providers: [ServiceAccountService],
  exports: [ServiceAccountService],
})
export class ServiceAccountModule {}
