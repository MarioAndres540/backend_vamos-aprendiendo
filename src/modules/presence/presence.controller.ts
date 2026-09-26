import { Controller, Post, Get, Req, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PresenceService } from './presence.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@ApiTags('Presence')
@ApiBearerAuth()
@Controller('presence')
export class PresenceController {
    constructor(private readonly presenceService: PresenceService) { }

    @Post('connect')
    @UseGuards(JwtAuthGuard)
    connect(@Req() req: any) {
        return this.presenceService.connect(req.user.userId);
    }

    @Post('heartbeat')
    @UseGuards(JwtAuthGuard)
    heartbeat(@Req() req: any) {
        return this.presenceService.heartbeat(req.user.userId);
    }

    @Post('disconnect')
    @UseGuards(JwtAuthGuard)
    disconnect(@Req() req: any) {
        return this.presenceService.disconnect(req.user.userId);
    }

    @Get('status/:userId')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(Role.TEACHER, Role.ADMIN)
    getStatus(@Param('userId') userId: string) {
        return this.presenceService.getStatus(userId);
    }
}