import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { Image, ImageDocument } from './schemas/image.schema';

@Injectable()
export class UploadService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(
    private readonly config: ConfigService,
    @InjectModel(Image.name) private readonly imageModel: Model<ImageDocument>,
  ) {
    const accountId = this.config.getOrThrow<string>('CLOUDFLARE_ACCOUNT_ID');
    this.bucket = this.config.getOrThrow<string>('CLOUDFLARE_R2_BUCKET');
    this.publicBaseUrl = this.config.getOrThrow<string>('s3_bucket_url');

    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('CLOUDFLARE_R2_ACCESS_KEY_ID'),
        secretAccessKey: this.config.getOrThrow<string>('CLOUDFLARE_R2_SECRET_ACCESS_KEY'),
      },
    });
  }

  async uploadImage(
    file: Express.Multer.File,
    uploadedBy?: string,
  ) {
    const ext = extname(file.originalname) || '.jpg';
    const key = `images/${randomUUID()}${ext}`;

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );
    } catch (err: any) {
      throw new InternalServerErrorException(err?.message ?? 'R2 upload failed');
    }

    const url = `${this.publicBaseUrl}/${key}`;

    const image = await this.imageModel.create({
      cloudflareId: key,
      originalName: file.originalname,
      mimeType: file.mimetype,
      url,
      uploadedBy,
    });

    return {
      imageId: (image._id as any).toString(),
      cloudflareKey: key,
      url,
      originalName: image.originalName,
      mimeType: image.mimeType,
      uploadedBy: image.uploadedBy,
      createdAt: (image as any).createdAt,
    };
  }

  async getImage(imageId: string) {
    const image = await this.imageModel.findById(imageId).lean();
    if (!image) throw new NotFoundException('Image not found');

    return {
      imageId: (image._id as any).toString(),
      cloudflareKey: image.cloudflareId,
      url: image.url,
      originalName: image.originalName,
      mimeType: image.mimeType,
      uploadedBy: image.uploadedBy,
      createdAt: (image as any).createdAt,
    };
  }

  async getAllImages() {
    const images = await this.imageModel.find().sort({ createdAt: -1 }).lean();
    return images.map((image) => ({
      imageId: (image._id as any).toString(),
      cloudflareKey: image.cloudflareId,
      url: image.url,
      originalName: image.originalName,
      mimeType: image.mimeType,
      uploadedBy: image.uploadedBy,
      createdAt: (image as any).createdAt,
    }));
  }
}
