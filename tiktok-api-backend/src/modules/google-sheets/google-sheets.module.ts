import { Global, Module } from '@nestjs/common';
import { GoogleSheetsService } from './google-sheets.service';
import { SaRotatorService } from './sa-rotator.service';
import { ServiceAccountModule } from '../service-account/service-account.module';

@Global()
@Module({
  imports: [ServiceAccountModule],
  providers: [GoogleSheetsService, SaRotatorService],
  exports: [GoogleSheetsService, SaRotatorService],
})
export class GoogleSheetsModule {}
