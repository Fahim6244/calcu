/** Vehicle identity is descriptive only; this function never classifies authorization. */
export function vehicleDetails(plate,rows){const row=rows[plate];if(!row)return null;const [urbanNumber,generalNumber,brand,model]=row;return {brand,model,vehicle:brand+' '+model,urbanNumber,generalNumber,sourceDate:'2026-02-25',source:'vtc.html · listado urbano'};}
