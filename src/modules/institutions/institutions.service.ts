import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { PreauthCheckDto } from './dto/preauth-check.dto';
import { QueryInstitutionsDto } from './dto/query-institutions.dto';
import { CreateInstitutionDto } from './dto/create-institution.dto';

@Injectable()
export class InstitutionsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Obtiene la lista de colegios/institutos activos con filtros opcionales.
   */
  async findAll(query?: QueryInstitutionsDto) {
    const supabase = this.supabaseService.getClient();
    let dbQuery = supabase
      .from('institutions')
      .select('id, nit, name, type, city, address, phone, email, is_active')
      .eq('is_active', true)
      .is('deleted_at', null);

    if (query?.type) {
      dbQuery = dbQuery.eq('type', query.type);
    }

    if (query?.search) {
      const term = query.search.trim();
      dbQuery = dbQuery.or(`name.ilike.%${term}%,city.ilike.%${term}%,nit.ilike.%${term}%`);
    }

    const { data, error } = await dbQuery.order('name', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(`Error al consultar instituciones: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Obtiene una institución por su ID.
   */
  async findById(id: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('institutions')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error || !data) {
      throw new NotFoundException(`No se encontró la institución con ID: ${id}`);
    }

    return data;
  }

  /**
   * Valida si un docente está previamente registrado/autorizado por la institución.
   */
  async checkTeacherPreauth(dto: PreauthCheckDto): Promise<{ isAuthorized: boolean; preauthId?: string; fullName?: string }> {
    const supabase = this.supabaseService.getClient();

    // 1. Verificar si la institución existe y está activa
    await this.findById(dto.institutionId);

    // 2. Consultar en institution_preauth_teachers
    const { data: preauthRecord, error } = await supabase
      .from('institution_preauth_teachers')
      .select('id, full_name, is_registered')
      .eq('institution_id', dto.institutionId)
      .eq('document_number', dto.documentNumber.trim())
      .ilike('email', dto.email.trim())
      .single();

    if (error || !preauthRecord) {
      throw new ForbiddenException(
        'No figuras como docente autorizado por esta institución. Comunícate con la administración de tu colegio.',
      );
    }

    if (preauthRecord.is_registered) {
      throw new BadRequestException(
        'Este docente ya completó su registro previamente. Por favor inicia sesión.',
      );
    }

    return {
      isAuthorized: true,
      preauthId: preauthRecord.id,
      fullName: preauthRecord.full_name || undefined,
    };
  }

  /**
   * Crear una nueva institución (Administrador)
   */
  async create(dto: CreateInstitutionDto) {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('institutions')
      .insert({
        nit: dto.nit,
        name: dto.name,
        type: dto.type,
        address: dto.address,
        city: dto.city,
        phone: dto.phone || null,
        email: dto.email || null,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      throw new BadRequestException(`Error al registrar institución: ${error.message}`);
    }

    return {
      message: 'Institución creada exitosamente',
      institution: data,
    };
  }
}
