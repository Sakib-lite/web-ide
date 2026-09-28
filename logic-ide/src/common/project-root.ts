import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const Root = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | undefined => {
  const req = ctx.switchToHttp().getRequest();
  return req.query?.root || req.body?.root;
});
