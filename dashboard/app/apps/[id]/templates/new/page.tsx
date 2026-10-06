import { SchemaBuilder } from "@/components/SchemaBuilder"

export default function NewTemplatePage({ params }: { params: { id: string } }) {
  return <SchemaBuilder appId={params.id} />
}
