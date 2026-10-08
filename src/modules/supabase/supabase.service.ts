import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// En el servidor no hay almacenamiento ni URL de navegador: no persistir ni refrescar sesiones
const SERVER_AUTH_OPTIONS = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private client: SupabaseClient;
  private supabaseUrl?: string;
  private supabaseKey?: string;

  constructor(private configService: ConfigService) { }

  onModuleInit() {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey =
      this.configService.get<string>('SUPABASE_KEY') ||
      this.configService.get<string>('SUPABASE_ANON_KEY') ||
      this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('TU_SUPABASE_URL')) {
      this.logger.warn(
        '⚠️ SUPABASE_URL o SUPABASE_KEY no están configuradas correctamente en el archivo .env',
      );
      return;
    }

    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;

    try {
      // Cliente administrativo (llave secreta): nunca debe guardar sesiones de usuario
      this.client = createClient(supabaseUrl, supabaseKey, SERVER_AUTH_OPTIONS);
      this.logger.log('🔌 Cliente de Supabase inicializado correctamente.');
      this.testConnection();
    } catch (error: any) {
      this.logger.error(`❌ Error al instanciar cliente de Supabase: ${error.message}`);
    }
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  /**
   * Crea un cliente desechable para operaciones que inician una sesión de usuario
   * (signUp, signInWithPassword, signInWithIdToken).
   * supabase-js guarda en memoria la sesión obtenida y la usa en las consultas siguientes de ese cliente;
   * si se hiciera sobre el cliente compartido, todo el backend consultaría la base como ese usuario (con RLS)
   * en lugar de usar la llave secreta.
   */
  createAuthClient(): SupabaseClient {
    if (!this.supabaseUrl || !this.supabaseKey) {
      throw new Error('Supabase no está configurado (SUPABASE_URL / llave en .env)');
    }
    return createClient(this.supabaseUrl, this.supabaseKey, SERVER_AUTH_OPTIONS);
  }

  async testConnection() {
    if (!this.client) return;

    try {
      // Realizamos una petición de verificación simple a Supabase
      const { error } = await this.client.from('_connection_test').select('*').limit(1);

      if (error) {
        // Si el error es solo que la tabla no existe (42P01 / PGRST204), la conexión y auth fueron exitosas
        if (
          error.code === 'PGRST204' ||
          error.code === 'PGRST205' ||
          error.code === '42P01' ||
          error.message.includes('relation') ||
          error.message.includes('does not exist') ||
          error.message.includes('Could not find the table')
        ) {
          this.logger.log('✅ ¡Conexión con Supabase verificada con éxito!');
        } else if (error.code === 'PGRST301' || error.message.includes('JWT') || (error as any).status === 401) {
          this.logger.error('❌ Error de autenticación en Supabase: Clave API o Token inválido.');
        } else {
          this.logger.log(`✅ Conexión con Supabase activa (Respuesta de BD: ${error.message})`);
        }
      } else {
        this.logger.log('✅ ¡Conexión con Supabase verificada con éxito!');
      }
    } catch (err: any) {
      this.logger.error(`❌ Error al verificar conexión con Supabase: ${err.message}`);
    }
  }

}
