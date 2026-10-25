
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "announcements": {
                  Row: {
                    "active": boolean,"body": string,"created_at": string,"created_by": string | null,"event_id": string,"id": string,"level": Database["public"]['Enums']["announcement_level"]
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"body": string,"created_at"?: string,"created_by"?: string | null,"event_id": string,"id"?: string,"level"?: Database["public"]['Enums']["announcement_level"]
                  }
                  Update: {
                    "active"?: boolean,"body"?: string,"created_at"?: string,"created_by"?: string | null,"event_id"?: string,"id"?: string,"level"?: Database["public"]['Enums']["announcement_level"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "announcements_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"assignments": {
                  Row: {
                    "created_at": string,"id": string,"panel_id": string,"round": number,"schedule_id": string,"slot_id": string,"status": Database["public"]['Enums']["assignment_status"],"team_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"panel_id": string,"round"?: number,"schedule_id": string,"slot_id": string,"status"?: Database["public"]['Enums']["assignment_status"],"team_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"panel_id"?: string,"round"?: number,"schedule_id"?: string,"slot_id"?: string,"status"?: Database["public"]['Enums']["assignment_status"],"team_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assignments_panel_id_fkey"
      columns: ["panel_id"]
isOneToOne: false
      referencedRelation: "panels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_schedule_id_fkey"
      columns: ["schedule_id"]
isOneToOne: false
      referencedRelation: "schedules"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_slot_id_fkey"
      columns: ["slot_id"]
isOneToOne: false
      referencedRelation: "slots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "checkin_closes_at": string | null,"checkin_opens_at": string | null,"created_at": string,"id": string,"name": string,"slot_minutes": number,"slug": string,"timezone": string,"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "checkin_closes_at"?: string | null,"checkin_opens_at"?: string | null,"created_at"?: string,"id"?: string,"name": string,"slot_minutes"?: number,"slug": string,"timezone"?: string,"year": number
                  }
                  Update: {
                    "checkin_closes_at"?: string | null,"checkin_opens_at"?: string | null,"created_at"?: string,"id"?: string,"name"?: string,"slot_minutes"?: number,"slug"?: string,"timezone"?: string,"year"?: number
                  }
                  Relationships: [
                    
                  ]
                },"judges": {
                  Row: {
                    "affiliation": string | null,"created_at": string,"email": string,"event_id": string,"full_name": string,"id": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "affiliation"?: string | null,"created_at"?: string,"email": string,"event_id": string,"full_name": string,"id"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "affiliation"?: string | null,"created_at"?: string,"email"?: string,"event_id"?: string,"full_name"?: string,"id"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "judges_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"panel_judges": {
                  Row: {
                    "judge_id": string,"panel_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "judge_id": string,"panel_id": string
                  }
                  Update: {
                    "judge_id"?: string,"panel_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "panel_judges_judge_id_fkey"
      columns: ["judge_id"]
isOneToOne: false
      referencedRelation: "judges"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "panel_judges_panel_id_fkey"
      columns: ["panel_id"]
isOneToOne: false
      referencedRelation: "panels"
      referencedColumns: ["id"]
    }
                  ]
                },"panels": {
                  Row: {
                    "event_id": string,"id": string,"label": string,"location_text": string | null,"map_x": number | null,"map_y": number | null,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "event_id": string,"id"?: string,"label": string,"location_text"?: string | null,"map_x"?: number | null,"map_y"?: number | null,"sort_order"?: number
                  }
                  Update: {
                    "event_id"?: string,"id"?: string,"label"?: string,"location_text"?: string | null,"map_x"?: number | null,"map_y"?: number | null,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "panels_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"email": string,"full_name": string | null,"role": Database["public"]['Enums']["user_role"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"full_name"?: string | null,"role"?: Database["public"]['Enums']["user_role"],"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"full_name"?: string | null,"role"?: Database["public"]['Enums']["user_role"],"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"schedules": {
                  Row: {
                    "event_id": string,"generated_at": string,"generated_by": string | null,"id": string,"published_at": string | null,"round": number,"stats": Json | null,"status": Database["public"]['Enums']["schedule_status"],"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "event_id": string,"generated_at"?: string,"generated_by"?: string | null,"id"?: string,"published_at"?: string | null,"round"?: number,"stats"?: Json | null,"status"?: Database["public"]['Enums']["schedule_status"],"version": number
                  }
                  Update: {
                    "event_id"?: string,"generated_at"?: string,"generated_by"?: string | null,"id"?: string,"published_at"?: string | null,"round"?: number,"stats"?: Json | null,"status"?: Database["public"]['Enums']["schedule_status"],"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "schedules_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"scores": {
                  Row: {
                    "assignment_id": string,"created_at": string,"criterion": string,"id": string,"judge_id": string,"notes": string | null,"updated_at": string,"value": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "assignment_id": string,"created_at"?: string,"criterion": string,"id"?: string,"judge_id": string,"notes"?: string | null,"updated_at"?: string,"value"?: number | null
                  }
                  Update: {
                    "assignment_id"?: string,"created_at"?: string,"criterion"?: string,"id"?: string,"judge_id"?: string,"notes"?: string | null,"updated_at"?: string,"value"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "scores_assignment_id_fkey"
      columns: ["assignment_id"]
isOneToOne: false
      referencedRelation: "assignments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scores_judge_id_fkey"
      columns: ["judge_id"]
isOneToOne: false
      referencedRelation: "judges"
      referencedColumns: ["id"]
    }
                  ]
                },"slots": {
                  Row: {
                    "ends_at": string,"id": string,"index": number,"schedule_id": string,"starts_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ends_at": string,"id"?: string,"index": number,"schedule_id": string,"starts_at": string
                  }
                  Update: {
                    "ends_at"?: string,"id"?: string,"index"?: number,"schedule_id"?: string,"starts_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "slots_schedule_id_fkey"
      columns: ["schedule_id"]
isOneToOne: false
      referencedRelation: "schedules"
      referencedColumns: ["id"]
    }
                  ]
                },"team_members": {
                  Row: {
                    "created_at": string,"email": string,"full_name": string | null,"is_captain": boolean,"team_id": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"full_name"?: string | null,"is_captain"?: boolean,"team_id": string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"full_name"?: string | null,"is_captain"?: boolean,"team_id"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_members_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"team_tracks": {
                  Row: {
                    "team_id": string,"track_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "team_id": string,"track_id": string
                  }
                  Update: {
                    "team_id"?: string,"track_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_tracks_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_tracks_track_id_fkey"
      columns: ["track_id"]
isOneToOne: false
      referencedRelation: "tracks"
      referencedColumns: ["id"]
    }
                  ]
                },"teams": {
                  Row: {
                    "all_freshmen": boolean | null,"checked_in_at": string | null,"contact_email": string | null,"contact_phone": string | null,"created_at": string,"created_by": string | null,"devpost_url": string | null,"event_id": string,"github_urls": (string)[],"half_or_more_non_male": boolean | null,"has_grad_student": boolean | null,"id": string,"join_code": string,"name": string,"notes": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "all_freshmen"?: boolean | null,"checked_in_at"?: string | null,"contact_email"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"devpost_url"?: string | null,"event_id": string,"github_urls"?: (string)[],"half_or_more_non_male"?: boolean | null,"has_grad_student"?: boolean | null,"id"?: string,"join_code": string,"name": string,"notes"?: string | null
                  }
                  Update: {
                    "all_freshmen"?: boolean | null,"checked_in_at"?: string | null,"contact_email"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"devpost_url"?: string | null,"event_id"?: string,"github_urls"?: (string)[],"half_or_more_non_male"?: boolean | null,"has_grad_student"?: boolean | null,"id"?: string,"join_code"?: string,"name"?: string,"notes"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "teams_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"tracks": {
                  Row: {
                    "event_id": string,"id": string,"judged_live": boolean,"name": string,"sort_order": number,"sponsor": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "event_id": string,"id"?: string,"judged_live"?: boolean,"name": string,"sort_order"?: number,"sponsor"?: string | null
                  }
                  Update: {
                    "event_id"?: string,"id"?: string,"judged_live"?: boolean,"name"?: string,"sort_order"?: number,"sponsor"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tracks_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "active_announcements":
{ Args: { "p_event_slug": string }; Returns: {
              "body": string,"created_at": string,"level": Database["public"]['Enums']["announcement_level"]
            }[]
                           },
"is_organizer":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_schedule_published":
{ Args: { "p_schedule": string }; Returns: boolean
                           },
"my_judge_ids":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"my_judged_team_ids":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"my_panel_ids":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"my_team_ids":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"public_board":
{ Args: { "p_event_slug": string }; Returns: {
              "location_text": string,"panel_label": string,"slot_index": number,"starts_at": string,"team_name": string
            }[]
                           },
"publish_schedule":
{ Args: { "p_schedule_id": string }; Returns: undefined
                           },
"team_schedule_by_code":
{ Args: { "p_code": string }; Returns: {
              "ends_at": string,"location_text": string,"panel_label": string,"slot_index": number,"starts_at": string,"team_name": string,"track_names": (string)[]
            }[]
                           }
          }
          Enums: {
            "announcement_level": "info"|"warning"|"critical","assignment_status": "scheduled"|"cancelled"|"completed","schedule_status": "draft"|"published"|"archived","user_role": "participant"|"judge"|"organizer"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "announcement_level": ["info", "warning", "critical"],"assignment_status": ["scheduled", "cancelled", "completed"],"schedule_status": ["draft", "published", "archived"],"user_role": ["participant", "judge", "organizer"]
          }
        }
} as const
