{{- define "anncur.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "anncur.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "anncur.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "anncur.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "anncur.selectorLabels" -}}
app.kubernetes.io/name: {{ include "anncur.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* The API's pods. The web and Job pods share anncur.selectorLabels, so the component tells them apart. */}}
{{- define "anncur.apiSelectorLabels" -}}
{{ include "anncur.selectorLabels" . }}
app.kubernetes.io/component: api
{{- end }}

{{- define "anncur.embedded" -}}
{{- if eq .Values.auth.mode "embedded" }}true{{- end }}
{{- end }}

{{/* Fails the render for settings that cannot work together. */}}
{{- define "anncur.validate" -}}
{{- if not (has .Values.auth.mode (list "external" "embedded")) }}
{{- fail "auth.mode must be external or embedded" }}
{{- end }}
{{- if and (include "anncur.embedded" .) .Values.zitadel.provision.enabled }}
{{- fail "zitadel.provision.enabled is for auth.mode=external" }}
{{- end }}
{{- if and (include "anncur.embedded" .) (not .Values.secrets.existingSecret) (lt (len (default "" .Values.secrets.authSecret)) 32) }}
{{- fail "secrets.authSecret (at least 32 characters) is required when auth.mode=embedded" }}
{{- end }}
{{- if and .Values.postgres.enabled .Values.secrets.databaseUrl }}
{{- fail "secrets.databaseUrl is built for you when postgres.enabled; leave it empty" }}
{{- end }}
{{- if and .Values.postgres.enabled (not .Values.secrets.existingSecret) (not .Values.postgres.password) }}
{{- fail "postgres.password (or secrets.existingSecret holding POSTGRES_PASSWORD) is required when postgres.enabled" }}
{{- end }}
{{- if and .Values.postgres.enabled .Values.postgres.password (not (regexMatch "^[A-Za-z0-9._~-]+$" .Values.postgres.password)) }}
{{- fail "postgres.password goes into DATABASE_URL unescaped; use only letters, digits and . _ ~ -" }}
{{- end }}
{{- if and .Values.ingress.enabled .Values.route.enabled }}
{{- fail "enable ingress or route, not both" }}
{{- end }}
{{- if not (has .Values.auth.signup (list "approval" "open" "closed")) }}
{{- fail "auth.signup must be approval, open or closed" }}
{{- end }}
{{- /* Releases before the API selector gained its component cannot be upgraded in place: the selector is immutable. */}}
{{- $api := lookup "apps/v1" "Deployment" .Release.Namespace (include "anncur.fullname" .) }}
{{- if and $api (not (hasKey $api.spec.selector.matchLabels "app.kubernetes.io/component")) }}
{{- fail (printf "the %s Deployment predates the API selector change; run `kubectl delete deployment %s --cascade=orphan -n %s` first (docs/operator-guide.md, section 6)" (include "anncur.fullname" .) (include "anncur.fullname" .) .Release.Namespace) }}
{{- end }}
{{- end }}

{{- define "anncur.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) }}
{{- end }}

{{- define "anncur.webImage" -}}
{{- printf "%s:%s" .Values.web.image.repository (default .Chart.AppVersion .Values.web.image.tag) }}
{{- end }}

{{/* The main host's paths the API serves, space-separated; the rest go to the site. Shared by the Ingress and the Routes. */}}
{{- define "anncur.apiPaths" -}}
{{- $paths := list "/annotations" "/x" "/sidebar" "/guest.js" "/healthz" "/readyz" }}
{{- if include "anncur.embedded" .ctx }}
{{- /* The issuer and its account routes; the site's own /auth/callback is not among them. */}}
{{- $paths = concat $paths (list "/oidc" "/idp" "/.well-known/openid-configuration") }}
{{- end }}
{{- if .metrics }}
{{- $paths = append $paths "/metrics" }}
{{- end }}
{{- join " " $paths }}
{{- end }}

{{- define "anncur.postgresHost" -}}
{{- printf "%s-postgres" (include "anncur.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Distinct from anncur.selectorLabels, which the API Deployment selects on. */}}
{{- define "anncur.postgresSelectorLabels" -}}
app.kubernetes.io/name: {{ printf "%s-postgres" (include "anncur.name" .) }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: postgres
{{- end }}

{{- define "anncur.secretName" -}}
{{- default (include "anncur.fullname" .) .Values.secrets.existingSecret }}
{{- end }}

{{/* Written by the Zitadel provisioning Job, not by Helm. */}}
{{- define "anncur.oidcConfigMap" -}}
{{- printf "%s-oidc" (include "anncur.fullname" .) }}
{{- end }}

{{/* The client id from the provisioning Job's ConfigMap, as the variable `name`. */}}
{{- define "anncur.provisionedClientId" -}}
- name: {{ .name }}
  valueFrom:
    configMapKeyRef:
      name: {{ include "anncur.oidcConfigMap" .root }}
      key: OIDC_CLIENT_ID
{{- end }}

{{/* Environment shared by the API container and the migration init container. */}}
{{- define "anncur.containerEnv" -}}
env:
  {{- if .Values.postgres.enabled }}
  - name: POSTGRES_PASSWORD
    valueFrom:
      secretKeyRef:
        name: {{ include "anncur.secretName" . }}
        key: POSTGRES_PASSWORD
  - name: DATABASE_URL
    value: {{ printf "postgres://%s:$(POSTGRES_PASSWORD)@%s:5432/%s" .Values.postgres.username (include "anncur.postgresHost" .) .Values.postgres.database | quote }}
  {{- else }}
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: {{ include "anncur.secretName" . }}
        key: {{ .Values.secrets.databaseUrlKey }}
  {{- end }}
  {{- if .Values.zitadel.provision.enabled }}
  {{- include "anncur.provisionedClientId" (dict "root" . "name" "OIDC_CLIENT_ID") | nindent 2 }}
  {{- end }}
  {{- if include "anncur.embedded" . }}
  - name: AUTH_SECRET
    valueFrom:
      secretKeyRef:
        name: {{ include "anncur.secretName" . }}
        key: AUTH_SECRET
  {{- if and .Values.auth.mail.from (or .Values.secrets.smtpUrl .Values.secrets.existingSecret) }}
  - name: SMTP_URL
    valueFrom:
      secretKeyRef:
        name: {{ include "anncur.secretName" . }}
        key: SMTP_URL
        optional: true
  {{- end }}
  {{- range $id, $upper := dict "google" "GOOGLE" "github" "GITHUB" "oidc" "OIDC" }}
  {{- if (index $.Values.auth.providers $id).clientId }}
  - name: UPSTREAM_{{ $upper }}_CLIENT_SECRET
    valueFrom:
      secretKeyRef:
        name: {{ include "anncur.secretName" $ }}
        key: UPSTREAM_{{ $upper }}_CLIENT_SECRET
  {{- end }}
  {{- end }}
  {{- end }}
envFrom:
  - configMapRef:
      name: {{ include "anncur.fullname" . }}
{{- end }}
