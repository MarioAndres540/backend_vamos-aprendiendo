---
name: nestjs-module-generator
description: Generates clean, robust, and tested NestJS 11 modules following the "Vamos Aprendiendo Web" project architecture. Activates when creating new backend features, entities, endpoints, DTOs, or services.
---

# NestJS Module Generator

Use this skill whenever you need to create or refactor a feature module in the NestJS backend (`src/modules/<feature-name>`).

## Standard Directory Structure

```text
src/modules/<feature-name>/
├── dto/
│   ├── create-<feature-name>.dto.ts
│   └── update-<feature-name>.dto.ts
├── <feature-name>.controller.ts
├── <feature-name>.controller.spec.ts
├── <feature-name>.service.ts
├── <feature-name>.service.spec.ts
└── <feature-name>.module.ts
```

## Step-by-Step Generation Workflow

### 1. Define DTOs (`dto/`)
Use `class-validator` and `class-transformer` decorators for input sanitization:

```typescript
import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';

export class CreateItemDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;
}
```

### 2. Implement the Service (`<feature-name>.service.ts`)
Inject `SupabaseService` to interact with PostgreSQL / Supabase:

```typescript
import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateItemDto } from './dto/create-item.dto';

@Injectable()
export class ItemService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findAll() {
    const { data, error } = await this.supabaseService.getClient()
      .from('items')
      .select('*');

    if (error) throw new InternalServerErrorException(error.message);
    return data;
  }

  async findOne(id: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('items')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundException(`Item with ID ${id} not found`);
    return data;
  }
}
```

### 3. Implement the Controller (`<feature-name>.controller.ts`)
Add route annotations and guard protection:

```typescript
import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ItemService } from './item.service';
import { CreateItemDto } from './dto/create-item.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('items')
export class ItemController {
  constructor(private readonly itemService: ItemService) {}

  @Get()
  findAll() {
    return this.itemService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() createItemDto: CreateItemDto) {
    return this.itemService.create(createItemDto);
  }
}
```

### 4. Register in `<feature-name>.module.ts` and `AppModule`
Import `SupabaseModule` if needed, export the service if shared, and register the new module in `src/app.module.ts`.

### 5. Add Unit Tests (`.spec.ts`)
Mock `SupabaseService` methods to test both success and error paths with Jest.
