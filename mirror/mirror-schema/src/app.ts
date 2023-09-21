import * as v from 'shared/src/valita.js';
import {firestoreDataConverter} from './converter.js';
import {deploymentOptionsSchema, deploymentSchema} from './deployment.js';

export const appSchema = v.object({
  cfID: v.string(),
  // Globally unique, stable, internal script name in Cloudflare.
  cfScriptName: v.string(),
  teamID: v.string(),

  // Denormalized from the `label` field of the Team doc. This is used, in conjunction
  // with the app `name`, to determine the hostname of the app worker URL:
  //
  // https://<app-name>-<teamlabel>.reflect-server.net.
  teamLabel: v.string(),

  /** @deprecated TODO(darick): Remove with the cli migration code. */
  teamSubdomain: v.string().optional(),

  // The user requested name, which must be suitable as a subdomain
  // (lower-cased alphanumeric with hyphens).
  //
  // Users can rename their app (and thus worker url) via the
  // app-rename command.
  name: v.string(),

  // The release channel from which server versions are chosen.
  //
  // Apps can only be created with a `StandardReleaseChannel` (i.e. "canary" and "stable",
  // type-restricted via the app.CreateRequest schema), but the App schema itself
  // allows for custom channels to be arbitrarily created/used for pushing builds
  // to particular apps or sets of them. Note that custom channels should be used
  // sparingly and temporarily, as they run the risk of being missed in the standard
  // release process.
  serverReleaseChannel: v.string(),

  deploymentOptions: deploymentOptionsSchema,

  // The App document tracks the running and queued deployments and serves as
  // a coordination point for (1) determining if a new deployment is necessary
  // (i.e. if the desired `DeploymentSpec` differs from that which is running)
  // and (2) ensuring that deployments are executed in their requested order.
  //
  // These fields are transactionally consistent views of the documents in the
  // deployments subcollection.
  runningDeployment: deploymentSchema.optional(),
  queuedDeploymentIDs: v.array(v.string()).optional(),
});

export type App = v.Infer<typeof appSchema>;

export const appDataConverter = firestoreDataConverter(appSchema);

// APP_COLLECTION and appPath() are defined in deployment.js to avoid a cyclic
// dependency (which otherwise breaks mjs targets). Re-export them here to be
// consistent with other schema files.
export {APP_COLLECTION, appPath} from './deployment.js';

export {isValidSubdomain as isValidAppName} from './team.js';
