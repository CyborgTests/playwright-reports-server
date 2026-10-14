{{- define "prs.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "prs.fullname" -}}
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

{{- define "prs.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "prs.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "prs.selectorLabels" -}}
app.kubernetes.io/name: {{ include "prs.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "prs.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "prs.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "prs.image" -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default (printf "v%s" .Chart.AppVersion)) }}
{{- end }}

{{/* Secret holding API_TOKEN / AUTH_SECRET: the existing one, or the one this chart creates. */}}
{{- define "prs.authSecretName" -}}
{{- .Values.auth.existingSecret | default (printf "%s-auth" (include "prs.fullname" .)) }}
{{- end }}

{{/* Non-empty when /app/data comes from the StatefulSet volumeClaimTemplates. */}}
{{- define "prs.dataClaimTemplate" -}}
{{- $p := .Values.storage.fs.persistence }}
{{- if and (eq .Values.storage.type "fs") $p.enabled (not $p.existingClaim) }}true{{ end }}
{{- end }}

{{- define "prs.validate" -}}
{{- if not (has .Values.storage.type (list "fs" "s3")) }}
{{- fail "storage.type must be fs or s3" }}
{{- end }}
{{- if eq .Values.storage.type "s3" }}
{{- if not .Values.storage.s3.endpoint }}{{ fail "storage.s3.endpoint is required with storage.type=s3" }}{{ end }}
{{- if not .Values.storage.s3.existingSecret }}{{ fail "storage.s3.existingSecret is required with storage.type=s3" }}{{ end }}
{{- end }}
{{- if and .Values.auth.enabled (not .Values.auth.existingSecret) }}
{{- if or (not .Values.auth.apiToken) (not .Values.auth.authSecret) }}
{{- fail "auth.enabled needs auth.existingSecret, or both auth.apiToken and auth.authSecret" }}
{{- end }}
{{- end }}
{{- end }}
