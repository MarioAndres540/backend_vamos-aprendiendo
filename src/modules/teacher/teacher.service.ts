import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { TeacherDashboardData } from './interfaces/teacher-dashboard.interface';
import { Role } from '../../common/enums/role.enum';

@Injectable()
export class TeacherService {
    constructor(private readonly supabaseService: SupabaseService) { }

    /**
      * Obtiene la información del dashboard del profesor: datos institucionales y estudiantes a cargo.
      */
    async getDashboard(teacherId: string): Promise<TeacherDashboardData> {
        const supabase = this.supabaseService.getClient();

        // 1. Validar existencia y rol del profesor en 'profiles'
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id, first_name, last_name, email, role, is_active, institution_id')
            .eq('id', teacherId)
            .single();

        if (profileError || !profile) {
            throw new NotFoundException('Perfil de profesor no encontrado');
        }

        if (profile.role !== Role.TEACHER) {
            throw new ForbiddenException('El usuario no posee permisos de Docente');
        }

        // 2. Si no tiene institución asignada, retornar estructura base vacía
        if (!profile.institution_id) {
            return {
                teacher: {
                    id: profile.id,
                    firstName: profile.first_name || '',
                    lastName: profile.last_name || '',
                    email: profile.email || '',
                },
                institution: null,
                totalStudents: 0,
                students: [],
            };
        }

        // 3. Obtener datos de la institución
        const { data: institution, error: instError } = await supabase
            .from('institutions')
            .select('id, name, code, address, phone, email')
            .eq('id', profile.institution_id)
            .single();

        if (instError) {
            throw new InternalServerErrorException(
                `Error al consultar institución: ${instError.message}`,
            );
        }

        // 4. Obtener estudiantes asignados al docente o a la institución
        const { data: students, error: studentsError } = await supabase
            .from('students')
            .select('id, first_name, last_name, document_type, document_number, grade, birth_date, is_active')
            .eq('institution_id', profile.institution_id)
            .eq('is_active', true)
            .order('last_name', { ascending: true });

        if (studentsError) {
            throw new InternalServerErrorException(
                `Error al consultar estudiantes: ${studentsError.message}`,
            );
        }

        const formattedStudents = (students || []).map((s) => ({
            id: s.id,
            firstName: s.first_name,
            lastName: s.last_name,
            documentType: s.document_type,
            documentNumber: s.document_number,
            grade: s.grade,
            birthDate: s.birth_date,
            isActive: s.is_active,
        }));

        return {
            teacher: {
                id: profile.id,
                firstName: profile.first_name || '',
                lastName: profile.last_name || '',
                email: profile.email || '',
            },
            institution: institution || null,
            totalStudents: formattedStudents.length,
            students: formattedStudents,
        };

    }
}