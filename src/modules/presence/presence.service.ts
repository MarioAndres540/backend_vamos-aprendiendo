import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

const ONLINE_THRESHOLD_SECONDS = 30; // heartbeat cada 15s + margen de 1 pulso perdido

@Injectable()
export class PresenceService {
    constructor(private readonly supabaseService: SupabaseService) { }

    async connect(userId: string) {
        const supabase = this.supabaseService.getClient();
        const now = new Date().toISOString();

        const { error } = await supabase
            .from('user_presence')
            .upsert(
                { user_id: userId, connected_at: now, last_heartbeat_at: now, disconnected_at: null },
                { onConflict: 'user_id' },
            );

        if (error) throw new InternalServerErrorException(`Error al registrar conexión: ${error.message}`);
        return { connectedAt: now };
    }

    async heartbeat(userId: string) {
        const supabase = this.supabaseService.getClient();
        const now = new Date().toISOString();

        const { error } = await supabase
            .from('user_presence')
            .update({ last_heartbeat_at: now, disconnected_at: null })
            .eq('user_id', userId);

        if (error) throw new InternalServerErrorException(`Error al registrar heartbeat: ${error.message}`);
        return { lastHeartbeatAt: now };
    }

    async disconnect(userId: string) {
        const supabase = this.supabaseService.getClient();
        const now = new Date().toISOString();

        const { error } = await supabase
            .from('user_presence')
            .update({ disconnected_at: now })
            .eq('user_id', userId);

        if (error) throw new InternalServerErrorException(`Error al registrar desconexión: ${error.message}`);
        return { disconnectedAt: now };
    }

    async getStatus(userId: string) {
        const supabase = this.supabaseService.getClient();
        const { data, error } = await supabase
            .from('user_presence')
            .select('connected_at, last_heartbeat_at, disconnected_at')
            .eq('user_id', userId)
            .single();

        if (error || !data) {
            return { isOnline: false, connectedAt: null, lastSeenAt: null, connectedSeconds: 0 };
        }

        const secondsSinceHeartbeat = (Date.now() - new Date(data.last_heartbeat_at).getTime()) / 1000;
        const isOnline = !data.disconnected_at && secondsSinceHeartbeat < ONLINE_THRESHOLD_SECONDS;
        const connectedSeconds = isOnline
            ? Math.floor((Date.now() - new Date(data.connected_at).getTime()) / 1000)
            : 0;

        return { isOnline, connectedAt: data.connected_at, lastSeenAt: data.last_heartbeat_at, connectedSeconds };
    }
}