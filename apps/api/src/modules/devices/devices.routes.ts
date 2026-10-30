import type { FastifyInstance } from "fastify";
import { requireContext } from "../../request-helpers.js";
import type { AppServices } from "../../services.js";
import { requireAuth } from "../../session-guard.js";
import { createDevice, listDevices, updateDevice } from "./devices.service.js";
import { createDeviceBody, customerDevicesParams, deviceParams, updateDeviceBody } from "./schemas.js";

export function deviceRoutes(deps: AppServices) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.post("/customers/:customerId/devices", { preHandler: requireAuth(deps, { permission: "device.create" }) }, async (request, reply) => {
      const { customerId } = customerDevicesParams.parse(request.params);
      const body = createDeviceBody.parse(request.body);
      return reply.code(201).send(await createDevice(deps, requireContext(request), customerId, body));
    });

    app.get("/customers/:customerId/devices", { preHandler: requireAuth(deps, { permission: "device.read" }) }, async (request) => {
      const { customerId } = customerDevicesParams.parse(request.params);
      return { devices: await listDevices(deps, requireContext(request), customerId) };
    });

    app.patch("/devices/:deviceId", { preHandler: requireAuth(deps, { permission: "device.update" }) }, async (request) => {
      const { deviceId } = deviceParams.parse(request.params);
      const body = updateDeviceBody.parse(request.body);
      return updateDevice(deps, requireContext(request), deviceId, body);
    });
  };
}
