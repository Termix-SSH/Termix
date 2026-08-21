# Helm and GitOps Deployment

This repository includes a Helm chart for deploying Termix to Kubernetes. Termix
and guacd run in the same pod by default so Guacamole recordings can share the
same persistent volume without cross-node `ReadWriteOnce` mount issues.
The guacd port is not exposed through a Service; only Termix can reach the
sidecar over the pod-local interface.

## Local Helm install

```sh
helm upgrade --install termix ./charts/termix \
  --namespace termix \
  --create-namespace
```

Port-forward for a quick check:

```sh
kubectl -n termix port-forward svc/termix 8080:8080
```

## Standard Ingress

Copy `charts/termix/values-gitops-example.yaml` and change the host, TLS secret,
storage class, and image tag for your environment:

```sh
helm upgrade --install termix ./charts/termix \
  --namespace termix \
  --create-namespace \
  --values charts/termix/values-gitops-example.yaml
```

## Traefik

For Traefik CRDs, use `values-traefik.yaml`:

```sh
helm upgrade --install termix ./charts/termix \
  --namespace termix \
  --create-namespace \
  --values charts/termix/values-traefik.yaml
```

Set `traefik.ingressRoute.host`, `entryPoints`, and either `tls.secretName` or
`tls.certResolver` to match your cluster.

## Argo CD

Example applications are provided in `deploy/argocd/`.

```sh
kubectl apply -f deploy/argocd/application.yaml
```

Use `application-traefik.yaml` for Traefik IngressRoute deployments.

## GitHub Actions

`.github/workflows/helm.yml` lints and renders the chart on pull requests. It can
also publish the chart to GHCR as an OCI chart from a manual workflow run:

```sh
helm pull oci://ghcr.io/<owner>/charts/termix --version 0.1.0
```

## GitLab CI

`deploy/gitlab/.gitlab-ci.yml` is a drop-in pipeline example. Copy it to the repo
root as `.gitlab-ci.yml` in GitLab, then set these CI variables:

- `KUBE_CONFIG`: base64-encoded kubeconfig for manual deploys.
- GitLab registry variables are provided automatically by GitLab CI.

The deploy job uses `helm upgrade --install --atomic` so a failed rollout is
rolled back by Helm.

## Secrets and databases

The default deployment uses SQLite under `/app/data`. For Postgres or MySQL,
set:

```yaml
database:
  dialect: postgres
  existingSecret:
    name: termix-database
    urlKey: DATABASE_URL
```

Create the secret separately:

```sh
kubectl -n termix create secret generic termix-database \
  --from-literal=DATABASE_URL='postgres://user:password@host:5432/termix'
```

For stable sessions across pod replacement, provide a `JWT_SECRET` and
optionally `GUACAMOLE_ENCRYPTION_KEY` through an existing secret or
`secrets.create`.

SQLite is intentionally limited to one replica. Configure Postgres or MySQL
before increasing `replicaCount` or enabling autoscaling.
