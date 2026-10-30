import type { FastifyInstance } from "fastify";
import { metaOf, requireContext } from "../../request-helpers.js";
import { requireAuth, type GuardDeps } from "../../session-guard.js";
import { createMemberBody, memberParams, updateMemberBody } from "../identity/schemas.js";
import { createMember, listMembers, updateMember } from "./team.service.js";

export function teamRoutes(deps: GuardDeps) {
  const guard = requireAuth(deps, { permission: "team.manage" });

  return async function register(app: FastifyInstance): Promise<void> {
    app.get("/team", { preHandler: guard }, async (request) => ({
      members: await listMembers(deps, requireContext(request)),
    }));

    app.post("/team/members", { preHandler: guard }, async (request, reply) => {
      const body = createMemberBody.parse(request.body);
      const created = await createMember(deps, requireContext(request), body, metaOf(request));
      return reply.code(201).send({ userId: created.userId });
    });

    app.patch("/team/members/:userId", { preHandler: guard }, async (request, reply) => {
      const { userId } = memberParams.parse(request.params);
      const body = updateMemberBody.parse(request.body);
      await updateMember(deps, requireContext(request), userId, body, metaOf(request));
      return reply.code(204).send();
    });
  };
}
