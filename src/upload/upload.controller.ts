import {
  Controller,
  Post,
  Get,
  Param,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Public } from '../auth/decorators/public.decorator';
import { UploadService } from './upload.service';

@Public()
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  /**
   * POST /upload/image
   * Content-Type: multipart/form-data
   * Field: file
   */
  @Post('image')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    return this.uploadService.uploadImage(file);
  }

  /**
   * GET /upload/image
   * Returns all uploaded images
   */
  @Get('image')
  async getAllImages() {
    return this.uploadService.getAllImages();
  }

  /**
   * GET /upload/image/:id
   * Returns a single image by MongoDB _id
   */
  @Get('image/:id')
  async getImage(@Param('id') id: string) {
    return this.uploadService.getImage(id);
  }
}
