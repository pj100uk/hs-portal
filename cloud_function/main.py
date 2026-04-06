import base64
import io
import json
import os
import time
from datetime import datetime, timezone

import requests
from google.cloud import storage
from google import genai
from google.genai import types

DATTO_BASE_URL = "https://eu.workplace.datto.com/2/api/v1"
DATTO_ROOT_FOLDER = 1239993420
REUPLOAD_AFTER_HOURS = 24  # re-upload when less than 24h of TTL remains


def datto_headers():
    client_id = os.environ["DATTO_CLIENT_ID"]
    client_secret = os.environ["DATTO_CLIENT_SECRET"]
    token = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def load_state(bucket_name, state_file):
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(state_file)
    if blob.exists():
        return json.loads(blob.download_as_text())
    return {}


def save_state(bucket_name, state_file, state):
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(state_file)
    blob.upload_from_string(json.dumps(state, indent=2), content_type="application/json")


def fetch_datto_files(folder_id, headers, folder_path=""):
    """Recursively fetch all .docx files under a Datto folder."""
    resp = requests.get(f"{DATTO_BASE_URL}/file/{folder_id}/files", headers=headers)
    resp.raise_for_status()
    data = resp.json()

    files = []
    for item in data.get("result", []):
        if item.get("folder"):
            sub_path = f"{folder_path}/{item['name']}" if folder_path else item["name"]
            files.extend(fetch_datto_files(item["id"], headers, sub_path))
        elif item["name"].endswith(".docx"):
            item["_path"] = f"{folder_path}/{item['name']}" if folder_path else item["name"]
            files.append(item)
    return files


def needs_upload(file_item, state):
    """Return True if the file should be (re-)uploaded to Gemini."""
    key = file_item["_path"]
    if key not in state:
        return True  # new file
    entry = state[key]
    if entry.get("md5") != file_item.get("md5"):
        return True  # content changed
    uploaded_at = datetime.fromisoformat(entry["uploaded_at"])
    age_hours = (datetime.now(timezone.utc) - uploaded_at).total_seconds() / 3600
    if age_hours >= REUPLOAD_AFTER_HOURS:
        return True  # approaching 48h TTL expiry
    return False


def upload_to_gemini(file_item, datto_headers_dict, client):
    """Download from Datto and upload to Gemini Files API. Returns Gemini file name."""
    file_id = file_item["id"]
    filename = file_item["name"]

    resp = requests.get(f"{DATTO_BASE_URL}/file/{file_id}/data", headers=datto_headers_dict)
    resp.raise_for_status()

    mime_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    file_bytes = io.BytesIO(resp.content)

    uploaded = client.files.upload(
        file=file_bytes,
        config=types.UploadFileConfig(mime_type=mime_type, display_name=filename),
    )
    return uploaded.name


def sync(request=None):
    """Cloud Function entry point. Also callable directly for local testing."""
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    bucket_name = os.environ["GCS_BUCKET"]
    state_file = os.environ.get("GCS_STATE_FILE", "datto_sync_state.json")

    headers = datto_headers()

    print("Loading sync state from GCS...")
    state = load_state(bucket_name, state_file)

    print(f"Fetching file list from Datto (root folder {DATTO_ROOT_FOLDER})...")
    datto_files = fetch_datto_files(DATTO_ROOT_FOLDER, headers)
    print(f"Found {len(datto_files)} .docx files in Datto")

    uploaded_count = 0
    skipped_count = 0

    for file_item in datto_files:
        key = file_item["_path"]
        if needs_upload(file_item, state):
            print(f"  Uploading: {key}")
            gemini_name = upload_to_gemini(file_item, headers, client)
            state[key] = {
                "datto_id": file_item["id"],
                "md5": file_item.get("md5"),
                "gemini_file_name": gemini_name,
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
            }
            uploaded_count += 1
        else:
            skipped_count += 1

    print(f"Sync complete: {uploaded_count} uploaded, {skipped_count} skipped")

    print("Saving updated state to GCS...")
    save_state(bucket_name, state_file, state)

    return f"Sync complete: {uploaded_count} uploaded, {skipped_count} skipped"


# Allow local invocation: python main.py
if __name__ == "__main__":
    result = sync()
    print(result)
